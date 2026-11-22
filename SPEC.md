# Auftrag: "Pixura Wandvorschau" – Web-Tool zum massstäblichen Platzieren eines Motivs auf einem Wandfoto

## Kontext
Pixura druckt Motive direkt auf Wände (nur Innenräume, meist weisse Wände). Beim Kundentermin soll ein Tablet oder Smartphone zeigen, wie gross ein Motiv an der Wand ist und wo es sitzt. Es geht um GRÖSSE und POSITION, nicht um Farbtreue oder Kontrast.

Kernidee: Wandfoto laden, eine bekannte Strecke bzw. ein bekanntes Rechteck an der Wand markieren und echte Masse eingeben, dann das Kundenbild in echten Zentimetern darüberlegen, verschieben und skalieren, mit Live-Massen.

## Harte Rahmenbedingungen
- KEIN Backend, keine Datenbank, keine Accounts, kein Tracking, keine Analytics, keine externen Requests zur Laufzeit (keine CDNs, keine Webfonts von Drittanbietern).
- Alle Bilder werden ausschliesslich im Browser verarbeitet und verlassen das Gerät nie.
- Statische Auslieferung auf Netlify. Build: Vite + TypeScript (strict). Möglichst wenige Abhängigkeiten, begründe jede neue Dependency. Kein UI-Framework nötig, Vanilla TypeScript ist in Ordnung.
- Mobile-first, Touch-Bedienung (Pointer Events, Pinch-Zoom, Pan), Tap-Ziele mindestens 44 px, funktioniert auf iPad-Safari und Android-Chrome sowie Desktop.
- PWA: installierbar, nach dem ersten Laden offline nutzbar (Service Worker, Manifest, Icons).
- UI-Texte auf Deutsch in Schweizer Rechtschreibung (kein ß, z. B. "Grösse"), Code und Kommentare auf Englisch. Einheiten: cm und m, Dezimalkomma in der Anzeige.
- Grosse Fotos (bis ca. 12 MP) müssen flüssig bedienbar sein: intern auf maximal 4096 px Kantenlänge reduzieren. EXIF-Orientierung korrekt behandeln (z. B. createImageBitmap mit imageOrientation "from-image").

## Arbeitsweise
1. Plane zuerst. Schreibe noch keinen Code, bis du einen kurzen Plan mit Dateistruktur, Datenmodell, Rendering-Ansatz und Teststrategie vorgelegt hast. Frage nur nach, wenn etwas blockiert.
2. Arbeite strikt in den unten definierten Meilensteinen. Nach jedem Meilenstein: `npm run build`, Lint, Tests laufen lassen, kurz berichten, einen Git-Commit machen (sprechende Message). Beginne den nächsten Meilenstein erst nach meiner Freigabe.
3. Die Mathematik (Kalibrierung, Homographie) kommt in eigene, reine Funktionen ohne DOM-Abhängigkeit und wird mit Vitest getestet.
4. Keine Secrets, keine Deployments ohne meine ausdrückliche Anweisung.

## Datenmodell (Vorschlag, darfst du verbessern)
- Wall: Bild (ImageBitmap), Kalibrierung (Modus "linear" oder "perspective"), daraus eine Abbildung zwischen Bildpixeln und Wandkoordinaten in cm.
- Motif: Bild, Position (x, y in cm, Wandkoordinaten), Breite/Höhe in cm (Seitenverhältnis standardmässig gesperrt), Rotation in Grad, Deckkraft 0–100 %.
- Project: eine Wand, bis zu 3 Varianten (jeweils eigene Grösse/Position des gleichen oder eines anderen Motivs).

## Meilensteine

### M1 – Grundgerüst
- Projekt-Setup (Vite, TS strict, ESLint, Vitest), `netlify.toml` (Build `npm run build`, Publish `dist`), Security-Header (CSP ohne externe Quellen, X-Content-Type-Options, Referrer-Policy), Cache-Header für Assets.
- Wandfoto laden (Dateiauswahl und Kamera via `<input type="file" accept="image/*">`), anzeigen, Pan und Pinch-Zoom.
- PWA-Grundlage (Manifest, Service Worker, Platzhalter-Icons).
Abnahme: Build läuft, Seite zeigt ein geladenes Foto, lässt sich zoomen und verschieben.

### M2 – Zwei-Punkt-Kalibrierung und Motiv
- Kalibrierassistent: Nutzer tippt zwei Punkte im Foto an (verschiebbare Marker mit Lupe für präzises Setzen) und gibt die echte Distanz ein (cm oder m). Daraus Pixel pro cm. Annahme: Foto frontal aufgenommen.
- Hinweis im UI: Referenz sollte so gross wie möglich sein (mindestens ca. 1 m), sonst werden Fehler hochgerechnet. Bei kürzerer Referenz Warnung anzeigen.
- Motiv laden. Breite ODER Höhe in cm eingeben, das andere Mass folgt über das Seitenverhältnis (Sperre umschaltbar).
- Verschieben, Skalieren (Eckgriffe), Drehen, Deckkraft-Regler. Live-Anzeige von Breite × Höhe und Position.
Abnahme: Mit einem Testfoto und bekannter Referenz stimmt die Anzeige mathematisch (Unit-Tests für die Skalierungslogik).

### M3 – Vier-Punkt-Perspektive
- Zweiter Kalibriermodus: Nutzer tippt vier Ecken eines bekannten Rechtecks (z. B. Tür, Fenster, markierte Fläche) im Foto an und gibt Breite und Höhe in cm ein.
- Berechne die Homographie (DLT, 8 Gleichungen, eigenes Gauss-Eliminationsverfahren oder kleine Matrix-Funktion) zwischen Wandebene (cm) und Bild.
- Das Motiv wird perspektivisch korrekt ins Foto gerendert. Wähle den Ansatz (WebGL mit projektiver Texturabbildung ODER fein unterteiltes Dreiecksnetz in Canvas 2D), begründe die Wahl und stelle flüssiges Verschieben und Skalieren auf einem iPad sicher.
- Alle Interaktionen laufen in Wandkoordinaten (cm), nicht in Bildpixeln.
- Zeige einen Kalibrierfehler an (z. B. Rückprojektionsfehler in Pixeln bzw. in cm) und warne bei unplausibler Kalibrierung (z. B. entartetes Viereck).
Abnahme: Unit-Tests mit synthetischer Perspektive: Ein bekanntes Rechteck wird mit einer vorgegebenen Homographie in ein Testbild projiziert, danach muss die Rückrechnung Distanzen auf der Wandebene mit höchstens 1 % Abweichung liefern.

### M4 – Hilfslinien, Varianten, Export
- Optionale Hilfslinien: Nutzer kann "Boden", "Decke", linke und rechte Wandkante als Linien im Foto setzen. Das Tool zeigt dann die Abstände des Motivs zu diesen Linien in cm.
- Bis zu 3 Varianten pro Projekt (z. B. 2 m, 3 m, 4 m Breite), Umschalten per Tabs, Vergleichsansicht nebeneinander optional.
- Export als PNG und als PDF (1 Seite, Wandfoto mit Motiv, eingezeichnete Masse, Datum, Hinweis "Vorschau, Massangaben ca. ±X cm", X konfigurierbar, Standard 5). Teilen über die Web Share API (mit Dateien), Fallback: Download. PDF-Erzeugung möglichst ohne grosse Bibliothek, begründe die Wahl.
Abnahme: Export enthält korrekte Masse und ist auf dem Tablet teilbar.

### M5 – Persistenz, Politur, Deployment
- Projekte lokal speichern (IndexedDB): Liste der letzten Projekte, Laden, Duplizieren, Löschen. Zusätzlich "Alle lokalen Daten löschen".
- Offline-Test (Flugmodus), Lighthouse PWA und Accessibility mindestens 90.
- README mit: lokaler Start, Build, Netlify-Deployment (Git-Anbindung UND manueller Deploy via Netlify CLI oder Drag-and-drop von `dist`), bekannte Grenzen.
- Kurze In-App-Anleitung "So fotografierst du die Wand": frontal, ganze Wand im Bild, nicht im Ultraweitwinkel-Modus, Referenz (Massband, Türrahmen oder zwei Malerkrepp-Markierungen) sichtbar.

## Nicht im Umfang
AR/WebXR, Accounts oder Cloud-Speicher, Farbtreue oder Farbmanagement, Objekterkennung, Objektivverzerrungs-Korrektur (nur als Hinweis in der UI).

## Qualitätsanforderungen
- TypeScript strict, keine `any` ohne Begründung.
- Mathe-Funktionen mit Unit-Tests, inklusive Randfälle (kollineare Punkte, Distanz 0, sehr kleine Referenz).
- Keine Layout-Sprünge, Interaktionen laufen mit 60 fps auf einem aktuellen iPad.
- Fehlerzustände behandeln: Datei kein Bild, zu grosses Bild, abgebrochene Kalibrierung.
- Am Ende: kurze Liste, was du geprüft hast und was NICHT (z. B. nicht auf echtem iPad getestet), damit ich gezielt nachtesten kann.

Beginne jetzt mit dem Plan für M1 bis M5, kurz und konkret, und warte auf meine Freigabe.