import { imageToWallMatrix, wallToImage } from '../math/calibration'
import { mul3, type Mat3 } from '../math/homography'
import type { Box } from '../math/motif'
import { toScreen, type Size, type View } from '../math/view'
import type { Calibration, Motif } from '../model/types'

// Draws the motif as a full-screen pass: every screen pixel is mapped back through the wall
// calibration (affine or homography) into motif texture coordinates. Exact for any perspective.
const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uSize;
out vec2 vScreen;
void main() {
  vScreen = vec2((aPos.x * 0.5 + 0.5) * uSize.x, (0.5 - aPos.y * 0.5) * uSize.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vScreen;
uniform mat3 uM;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uSign;
out vec4 outColor;
void main() {
  vec3 q = uM * vec3(vScreen, 1.0);
  if (q.z * uSign <= 0.0) discard;
  vec2 uv = q.xy / q.z;
  vec2 d = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-6));
  float cov = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  outColor = texture(uTex, clamp(uv, 0.0, 1.0)) * (uOpacity * cov);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('createShader failed')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
  return s
}

// screen (CSS px) -> motif uv in [0,1]^2, as a row-major homography
export function screenToMotifUv(box: Box, cal: Calibration, view: View): Mat3 {
  const s = view.scale
  const sinv: Mat3 = [1 / s, 0, -view.tx / s, 0, 1 / s, -view.ty / s, 0, 0, 1]
  const r = (box.rot * Math.PI) / 180
  const c = Math.cos(r)
  const n = Math.sin(r)
  const mw: Mat3 = [
    c / box.w,
    n / box.w,
    0.5 - (c * box.x + n * box.y) / box.w,
    -n / box.h,
    c / box.h,
    0.5 - (-n * box.x + c * box.y) / box.h,
    0,
    0,
    1,
  ]
  return mul3(mw, mul3(imageToWallMatrix(cal), sinv))
}

export class MotifRenderer {
  private tex: WebGLTexture
  private bound: ImageBitmap | null = null
  private uM: WebGLUniformLocation | null
  private uSize: WebGLUniformLocation | null
  private uOpacity: WebGLUniformLocation | null
  private uSign: WebGLUniformLocation | null

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private gl: WebGL2RenderingContext,
  ) {
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    gl.useProgram(prog)

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

    const tex = gl.createTexture()
    if (!tex) throw new Error('createTexture failed')
    this.tex = tex
    this.uM = gl.getUniformLocation(prog, 'uM')
    this.uSize = gl.getUniformLocation(prog, 'uSize')
    this.uOpacity = gl.getUniformLocation(prog, 'uOpacity')
    this.uSign = gl.getUniformLocation(prog, 'uSign')
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0)
  }

  // Returns null where WebGL 2 is unavailable.
  static create(canvas: HTMLCanvasElement): MotifRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) return null
    try {
      return new MotifRenderer(canvas, gl)
    } catch {
      return null
    }
  }

  private upload(img: ImageBitmap): void {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max))
    }
    this.bound = img
  }

  render(motif: Motif | null, cal: Calibration | null, view: View, size: Size, dpr: number): void {
    const { gl, canvas } = this
    const w = Math.max(1, Math.round(size.w * dpr))
    const h = Math.max(1, Math.round(size.h * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!motif || !cal) return

    if (this.bound !== motif.image) this.upload(motif.image)
    const m = screenToMotifUv(motif.box, cal, view)
    // Which side of the horizon the motif centre is on; the other side is a mirrored phantom.
    const c = toScreen(view, wallToImage(cal, { x: motif.box.x, y: motif.box.y }))
    const z = (m[6] ?? 0) * c.x + (m[7] ?? 0) * c.y + (m[8] ?? 1)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniformMatrix3fv(this.uM, false, new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]))
    gl.uniform2f(this.uSize, size.w, size.h)
    gl.uniform1f(this.uOpacity, motif.opacity / 100)
    gl.uniform1f(this.uSign, z < 0 ? -1 : 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
