/*
  SmartShirt ESP32 Firmware
  Sensoren: MPU6050 (I2C) + 2x Flex (ADC)
  Ausgabe:  Serial  +  BLE Notify
*/

#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── Pins ─────────────────────────────────────────────────────────
#define I2C_SDA    18
#define I2C_SCL    22
#define MPU_ADDR   0x68
#define FLEX_LEFT  34
#define FLEX_RIGHT 35

// ── BLE ──────────────────────────────────────────────────────────
#define BLE_NAME     "SmartShirt-ESP32"
#define SVC_UUID     "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define TX_CHAR_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// ── Sensor Variablen ─────────────────────────────────────────────
int16_t accelX, accelY, accelZ, gyroX, gyroY, gyroZ;
float fL=0, fR=0, fAX=0, fAY=0, fAZ=0, fGX=0, fGY=0, fGZ=0;
const float ALPHA = 0.2f;

// ── BLE ──────────────────────────────────────────────────────────
BLECharacteristic* txChar = nullptr;

class BleCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    Serial.println("BLE Client verbunden");
  }
  void onDisconnect(BLEServer* s) override {
    Serial.println("BLE Client getrennt — starte Advertising neu");
    BLEDevice::startAdvertising();
  }
};

// ── MPU Hilfsfunktionen ──────────────────────────────────────────
void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}

bool mpuRead(uint8_t startReg, uint8_t count, uint8_t* buf) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(startReg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) buf[i] = Wire.read();
  return true;
}

float lp(float old, float neu) { return old + ALPHA * (neu - old); }

// ── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== SmartShirt Boot ===");

  // MPU6050
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  delay(200);
  mpuWrite(0x6B, 0x00);  // wake up
  delay(50);
  mpuWrite(0x1B, 0x08);  // Gyro ±500°/s
  mpuWrite(0x1C, 0x10);  // Accel ±8g
  Serial.println("MPU6050 bereit");

  // BLE
  BLEDevice::init(BLE_NAME);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new BleCallbacks());
  BLEService* svc = srv->createService(SVC_UUID);
  txChar = svc->createCharacteristic(TX_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
  BLE2902* desc = new BLE2902();
  desc->setNotifications(true);
  txChar->addDescriptor(desc);
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE Advertising gestartet — Name: SmartShirt-ESP32");
  Serial.println("=== Bereit ===\n");
}

// ── Loop ─────────────────────────────────────────────────────────
void loop() {
  uint8_t raw[14];
  if (!mpuRead(0x3B, 14, raw)) { delay(30); return; }

  accelX = (int16_t)((raw[0]<<8)|raw[1]);
  accelY = (int16_t)((raw[2]<<8)|raw[3]);
  accelZ = (int16_t)((raw[4]<<8)|raw[5]);
  gyroX  = (int16_t)((raw[8]<<8)|raw[9]);
  gyroY  = (int16_t)((raw[10]<<8)|raw[11]);
  gyroZ  = (int16_t)((raw[12]<<8)|raw[13]);

  fL  = lp(fL,  analogRead(FLEX_LEFT));
  fR  = lp(fR,  analogRead(FLEX_RIGHT));
  fAX = lp(fAX, accelX); fAY = lp(fAY, accelY); fAZ = lp(fAZ, accelZ);
  fGX = lp(fGX, gyroX);  fGY = lp(fGY, gyroY);  fGZ = lp(fGZ, gyroZ);

  String line = "L:"  + String((int)fL)  +
                ",R:" + String((int)fR)  +
                ",AX:"+ String((int)fAX) +
                ",AY:"+ String((int)fAY) +
                ",AZ:"+ String((int)fAZ) +
                ",GX:"+ String((int)fGX) +
                ",GY:"+ String((int)fGY) +
                ",GZ:"+ String((int)fGZ);

  Serial.println(line);
  if (txChar) { txChar->setValue(line.c_str()); txChar->notify(); }

  delay(35);
}
