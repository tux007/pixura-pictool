# Pixura Wandvorschau

Web-Tool für den Kundentermin: Wandfoto laden, eine bekannte Strecke oder ein bekanntes Rechteck markieren und echte Masse eingeben, dann das Motiv in echten Zentimetern darüberlegen, verschieben, skalieren und drehen. Es geht um **Grösse und Position**, nicht um Farbtreue.

- Läuft komplett im Browser. Kein Backend, keine Accounts, kein Tracking, keine externen Requests. Fotos verlassen das Gerät nie.
- Installierbare PWA, nach dem ersten Laden offline nutzbar.
- Mobile-first mit Touch-Bedienung (iPad-Safari, Android-Chrome, Desktop).

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| Bilder | Wandfoto und Motiv als JPEG, PNG, HEIC (wo der Browser es kann) oder **TIFF**. Dateiauswahl und Kamera, EXIF-Ausrichtung, intern max. 4096 px Kantenlänge, Pan und Pinch-Zoom |
| Kalibrierung | **Strecke (2 Punkte)** für frontale Fotos, **Rechteck (4 Punkte)** mit Perspektive (Homographie), Lupe, Warnungen und Kalibrierfehler |
| Motiv | Breite oder Höhe in cm/m eingeben, Seitenverhältnis sperrbar, Eckgriffe, Drehgriff, Deckkraft, Live-Masse |
| Hilfslinien | Boden, Decke, linke und rechte Wandkante; zeigt die Abstände des Motivs in cm |
| Varianten | Bis zu 3 pro Projekt (Tabs), Vergleichsansicht nebeneinander |
| Export | PNG, **TIFF** und PDF (1 Seite) mit Massen, Datum und Hinweis „Vorschau, Massangaben ca. ±X cm“ (X einstellbar, Standard 5); Teilen über die Web Share API, sonst Download |
| Projekte | Automatisch lokal gespeichert (IndexedDB): Liste, Öffnen, Duplizieren, Löschen, „Alle lokalen Daten löschen“ |

Texte sind Deutsch in Schweizer Rechtschreibung, Einheiten cm und m mit Dezimalkomma.

## Lokal starten

Voraussetzung: Node.js 22 (mindestens 20.19) und npm.

```bash
npm install
npm run dev
```

Der Dev-Server läuft auf <http://localhost:5173>. Im Dev-Modus ist der Service Worker aus.

### Build und Vorschau

```bash
npm run build
npm run preview
```

`npm run preview` liefert den Ordner `dist` unter <http://localhost:4173> aus, **mit** Service Worker. Für den Test auf dem Tablet im selben WLAN: `npm run preview -- --host`. Beachte: Safari erlaubt Service Worker und die Web Share API mit Dateien nur über HTTPS (oder localhost). Offline-Betrieb, Installation und Teilen testest du darum am besten auf der Netlify-URL.

### Prüfen

```bash
npm run lint
npm test            # Vitest: Mathematik, PDF- und TIFF-Writer, TIFF-Import, Speicher-Records
npm run test:e2e    # Playwright: baut selbst und startet einen Server auf Port 4174
```

Playwright braucht einmalig `npx playwright install chromium`.

Die Mathematik (Kalibrierung, Homographie, Motivgeometrie, Hilfslinien) liegt in `src/math/` ohne DOM-Abhängigkeit. Sie ist getestet, unter anderem mit einer synthetischen Kamera: Distanzen auf der Wandebene weichen nach der Rückrechnung um weniger als 1 % ab.

### Icons

Die Platzhalter-Icons und das Testfoto für die E2E-Tests erzeugt `scripts/make-icons.mjs` (`npm run icons`). Für die echten Icons die PNGs in `public/icons/` ersetzen (192, 512, 512 maskable, 180 apple-touch).

## Deployment auf Netlify

Das Projekt ist rein statisch. `netlify.toml` setzt Build-Befehl (`npm run build`), Publish-Ordner (`dist`) und Node 22. Die Sicherheits- und Cache-Header stehen in `public/_headers` und landen beim Build in `dist/_headers`. Dadurch gelten sie bei **allen** drei Wegen unten, auch bei Drag-and-drop.

### A) Git-Anbindung (empfohlen)

1. Repository auf GitHub, GitLab oder Bitbucket pushen.
2. In Netlify: **Add new site → Import an existing project** und das Repository wählen.
3. Build-Einstellungen werden aus `netlify.toml` übernommen (Build command `npm run build`, Publish directory `dist`). Deploy starten.
4. Jeder Push auf den Haupt-Branch deployt automatisch.

### B) Manuell mit der Netlify CLI

```bash
npm run build
npx netlify-cli login
npx netlify-cli deploy --dir=dist --create-site pixura-wandvorschau   # Entwurf mit Vorschau-URL
npx netlify-cli deploy --dir=dist --prod                              # Produktion
```

Beim ersten Mal legt `--create-site` die Seite an, danach genügt `deploy`. Der Name muss bei Netlify noch frei sein.

### C) Drag-and-drop

1. `npm run build`
2. <https://app.netlify.com/drop> öffnen und den Ordner `dist` hineinziehen.

### Nach dem Deploy prüfen

```bash
curl -sI https://<deine-seite>.netlify.app | grep -iE 'content-security|x-content-type|referrer|permissions'
```

Erwartet: CSP ohne externe Quellen, `nosniff`, `no-referrer`. Danach im Browser laden, in den DevTools (Network) auf **Offline** stellen bzw. am Tablet den Flugmodus aktivieren und neu laden: Die App muss weiter starten. Lighthouse (Accessibility und PWA-Installierbarkeit) misst du mit:

```bash
npx lighthouse https://<deine-seite>.netlify.app --view
```

## Bedienung in Kürze

1. **Foto wählen** oder **Kamera**.
2. **Kalibrieren:** entweder zwei Punkte einer bekannten Strecke (Referenz möglichst gross, ab ca. 1 m), oder im Modus „Rechteck“ die vier Ecken (oben links, oben rechts, unten rechts, unten links) einer Tür oder eines Fensters mit bekannter Breite und Höhe.
3. **Motiv** laden, Breite oder Höhe eingeben und auf dem Foto platzieren.
4. Optional **Linien** setzen, Varianten mit „+“ anlegen, **Export** als PNG oder PDF.

Die In-App-Anleitung „So fotografierst du die Wand“ steht unter **Anleitung**.

## Technik

- Vite 8, TypeScript (strict), Vanilla ohne UI-Framework. Es gibt **eine Runtime-Abhängigkeit**: [`utif`](https://github.com/photopea/UTIF.js) (MIT, mit `pako`), der TIFF-Decoder. Browser (ausser Safari) können TIFF nicht anzeigen, und ein eigener Decoder für alle Kompressionen, Farbmodelle und Bittiefen wäre viel Code und Fehlerquelle. Die Bibliothek wird lokal mitgebaut, ohne externe Requests, und erst beim Öffnen eines TIFF nachgeladen (eigener Teil, vom Service Worker für offline vorgeladen). Alles andere steht in `devDependencies` (Vite, TypeScript, Vitest, ESLint, Playwright).
- TIFF-Export von Hand (`src/export/tiff.ts`): 8 Bit RGB, Deflate-Kompression, 72 dpi. Der Browser hat keinen TIFF-Encoder.
- Rendering des Motivs mit WebGL 2: Jeder Bildschirmpixel wird über die inverse Kalibrierung (Skalierung oder Homographie) in Texturkoordinaten abgebildet. Das ist exakt und flüssig und vermeidet ein Dreiecksnetz in Canvas 2D mit Nähten und Näherungsfehlern.
- Service Worker von Hand (`src/sw/sw.ts`), die Precache-Liste wird beim Build eingesetzt. Keine Workbox.
- PDF von Hand (`src/export/pdf.ts`): ein JPEG und Text in Helvetica, rund 100 Zeilen statt einer grossen PDF-Bibliothek.
- Speicher: IndexedDB `pixura`, ein Eintrag pro Projekt mit den Originaldateien der Bilder.

```
src/math/      Kalibrierung, Homographie, Motiv, Hilfslinien, Einheiten (rein, getestet)
src/gl/        WebGL-Renderer fürs Motiv
src/render/    Beschriftungen, Szene für Export und Vergleich
src/export/    PDF-Writer, Teilen/Download
src/storage/   IndexedDB und Validierung
src/ui/        Oberfläche (Viewport, Kalibrierung, Panels)
src/sw/        Service Worker
e2e/           Playwright-Tests (Page Object Model)
```

## Bekannte Grenzen

- **Genauigkeit:** Die Vorschau ist eine Näherung. Fehler der Referenz werden auf die ganze Wand hochgerechnet; deshalb eine möglichst grosse Referenz verwenden (mindestens ca. 1 m).
- **Zwei-Punkt-Modus** nimmt ein frontal aufgenommenes Foto an. Bei schrägem Foto den Rechteck-Modus verwenden.
- **Objektivverzerrung** (Ultraweitwinkel) wird nicht korrigiert. Die Konsistenzprüfung im Rechteck-Modus nimmt den Bildhauptpunkt in der Bildmitte an und ist bei zugeschnittenen Fotos ungenauer.
- **Rückprojektionsfehler:** Bei genau vier Punkten wird die Homographie exakt angepasst, der Fehler ist deshalb rechnerisch fast 0. Aussagekräftiger ist die Prüfung des Seitenverhältnisses.
- **WebGL 2 ist nötig** (Safari ab 15, aktuelle Chrome/Firefox/Edge). Ohne WebGL 2 lassen sich Motive nicht darstellen.
- **Fotos** werden intern auf max. 4096 px Kantenlänge reduziert, Dateien über 60 MB werden abgelehnt.
- **TIFF:** Gelesen werden Graustufen, RGB, Palette und CMYK mit 8 oder 16 Bit (unkomprimiert, LZW, Deflate, PackBits). CMYK wird ohne Farbmanagement nach RGB umgerechnet, ein eingebettetes ICC-Profil wird ignoriert. Bei mehreren Bildern in einer Datei zählt das grösste, Ebenen werden nicht gelesen, BigTIFF wird nicht unterstützt. Das Dekodieren braucht den ganzen Speicher auf einmal, deshalb sind TIFFs über 50 Megapixel gesperrt (Meldung mit Hinweis). Der TIFF-Export enthält dasselbe wie das PNG (Vorschau mit Massen und Textband), kein Druckdatei-Ersatz.
- **Speicher:** Die Projekte liegen nur auf diesem Gerät. Safari löscht Website-Daten nach längerer Nichtnutzung (rund 7 Tage), wenn die Seite **nicht** als App zum Home-Bildschirm hinzugefügt ist. Für wichtige Projekte die App installieren oder PNG/PDF exportieren. Bei vollem Speicher erscheint eine Meldung.
- **Teilen** mit Dateien hängt vom Browser ab. Wo es nicht geht, wird heruntergeladen.
- Wird die Kalibrierung eines Projekts geändert, werden die Hilfslinien zurückgesetzt. Motive bleiben an derselben Stelle im Foto.
- Kein Rückgängig/Wiederholen, keine Cloud-Synchronisation, kein AR.
