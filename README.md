# SmartShirt Coach Prototype

Workout-orientierter Thesis-Prototyp mit 2 Übungen:

- Frontal Raise
- Side-to-side in Bauchlage

## Features

1. Verbindung über **USB Serial**, **Bluetooth BLE** oder Mockdaten
2. Kalibrierung: Standing + Prone
3. Optimum-Aufnahme je Übung
4. Live Coaching mit intuitivem Hinweis statt Zahlen
5. Übungsbilder direkt in der App

## Dateien

- `index.html`: UI inkl. Übungs-Karten und Illustration
- `app.js`: Serial + BLE Datenempfang, Kalibrierung, Optimum, Feedback
- `styles.css`: workout-app Look
- `assets/frontal-raise.svg`: Illustration Frontal Raise
- `assets/side-to-side.svg`: Illustration Side-to-side
- `firmware/smartshirt_capture.ino`: ESP32 Firmware (Flex + MPU6050 + BLE Notify)

## ESP32 Datenformat

Die App erwartet je Zeile:

```text
L:1234,R:1400,AX:20,AY:-300,AZ:16200,GX:10,GY:-4,GZ:2
```

## BLE Profil

Die Firmware nutzt ein UART-ähnliches BLE Profil:

- Service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- TX Characteristic (Notify): `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- Device Name: `SmartShirt-ESP32`

## Start (Laptop)

```bash
cd /workspace/smartshirt
python3 -m http.server 8080
```

Dann im Browser öffnen:

- `http://localhost:8080`

Empfehlung: Chrome oder Edge.

## Handy Hinweise

- Web Bluetooth in Mobile Browsern ist eingeschränkt.
- Für Android funktioniert es meist besser mit Chrome.
- Für iOS/Safari ist Web Bluetooth häufig limitiert; dann native App oder BLE-Bridge nutzen.
