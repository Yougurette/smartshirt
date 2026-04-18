# SmartShirt Coach Prototype

Kleine Web-App für deinen Thesis-Prototyp mit folgendem Flow:

1. ESP32 verbinden (Web Serial) oder Mockdaten starten
2. Zwei Kalibrierungen speichern (Standing + Prone)
3. Optimum je Übung aufnehmen (`frontal`, `side`)
4. Workout starten und direktes, nicht-technisches Feedback erhalten

## Dateien

- `index.html`: UI mit 4 Schritten (Verbindung, Kalibrierung, Optimum, Workout)
- `app.js`: Sensorstream parser, Kalibrierungslogik, Optimum-Recording, Live-Feedback
- `styles.css`: einfache visuelle Darstellung
- `firmware/smartshirt_capture.ino`: kombinierter ESP32-Sketch für 2x Flex + MPU6050

## ESP32 Datenformat

Die Web-App erwartet pro Zeile dieses CSV-ähnliche Format:

```text
L:1234,R:1400,AX:20,AY:-300,AZ:16200,GX:10,GY:-4,GZ:2
```

## Lokaler Start

Da Web Serial in einigen Browsern nur über sichere Kontexte läuft, starte lokal z. B. einen kleinen Server:

```bash
python3 -m http.server 8080
```

Dann öffnen:

- `http://localhost:8080`

Empfehlung: Chrome oder Edge (Web Serial Support).
