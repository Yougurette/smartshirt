# SmartShirt Coach Prototype

Workout-orientierter Thesis-Prototyp mit 2 Übungen:

- Frontal Raise
- Side-to-side in Bauchlage

## Features

1. Verbindung über **USB Serial**, **Bluetooth BLE** oder Mockdaten
2. Kalibrierung: Standing + Prone
3. Optimum-Aufnahme je Übung
4. Live Coaching mit intuitivem Hinweis statt Zahlen
5. Übungsbilder direkt in der App (2 Frames pro Übung)
6. Mini-Video-Effekt: die 2 Frames werden automatisch gewechselt

## Dateien

- `index.html`: UI inkl. Übungs-Karten und Illustration
- `app.js`: Serial + BLE Datenempfang, Kalibrierung, Optimum, Feedback + Frame-Animation
- `styles.css`: workout-app Look
- `assets/frontal-raise.svg`: Illustration Frontal Raise (Frame 1)
- `assets/frontal-raise-frame2.svg`: Illustration Frontal Raise (Frame 2)
- `assets/side-to-side.svg`: Illustration Side-to-side (Frame 1)
- `assets/side-to-side-frame2.svg`: Illustration Side-to-side (Frame 2)
- `firmware/smartshirt_capture.ino`: ESP32 Firmware (Flex + MPU6050 + BLE Notify)

## Eigene Bilder (deine Referenzbilder) einsetzen

Wenn du stattdessen deine echten Übungsbilder nutzen willst, ersetze einfach diese Dateien:

- `assets/frontal-raise.svg` und `assets/frontal-raise-frame2.svg`
- `assets/side-to-side.svg` und `assets/side-to-side-frame2.svg`

Du kannst auch PNG/JPG nutzen und nur die Dateinamen in `app.js` unter `EXERCISE_META.frames` anpassen.

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

## FAQ: Läuft der ESP32 ohne USB nach dem Upload?

Ja. Nach dem Flashen bleibt der Sketch auf dem ESP32 gespeichert (Flash-Speicher). Du kannst USB abziehen und den ESP32 z. B. über Powerbank/Batterie versorgen.

Wenn der Browser trotzdem „kein kompatibles Gerät“ zeigt:

1. Prüfe, ob der ESP32 wirklich Strom hat (LED an).
2. Drücke einmal `EN/RESET` nach dem Einschalten.
3. Nutze Chrome auf `http://localhost:8080` oder `http://127.0.0.1:8080`.
4. Firmware neu flashen (die BLE-UUIDs müssen zur Web-App passen).
5. Erst in der Web-App auf **ESP32 via Bluetooth (BLE)** klicken (kein separates Windows-Bluetooth-Pairing nötig).
6. Wichtig: Das ist **BLE**, nicht klassisches Bluetooth. Manche Bluetooth-Listen im OS zeigen das Gerät nicht wie Kopfhörer an.
