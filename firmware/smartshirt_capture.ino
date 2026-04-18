#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define I2C_SDA 18
#define I2C_SCL 22
#define MPU_ADDR 0x68
#define FLEX_LEFT 34
#define FLEX_RIGHT 35

#define BLE_DEVICE_NAME "SmartShirt-ESP32"
#define BLE_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_CHAR_TX_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // notify device -> app

int16_t accelX, accelY, accelZ;
int16_t gyroX, gyroY, gyroZ;

float filteredLeft = 0;
float filteredRight = 0;
float filteredAX = 0;
float filteredAY = 0;
float filteredAZ = 0;
float filteredGX = 0;
float filteredGY = 0;
float filteredGZ = 0;

const float alpha = 0.2f;
BLECharacteristic *txCharacteristic = nullptr;
bool bleClientConnected = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    bleClientConnected = true;
  }

  void onDisconnect(BLEServer *server) override {
    bleClientConnected = false;
    server->getAdvertising()->start();
  }
};

void setupBle() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(BLE_SERVICE_UUID);
  txCharacteristic = service->createCharacteristic(BLE_CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txCharacteristic->addDescriptor(new BLE2902());

  service->start();
  server->getAdvertising()->start();
}

void writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

bool readRegisters(uint8_t startReg, uint8_t count, uint8_t *data) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(startReg);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  uint8_t received = Wire.requestFrom(MPU_ADDR, count);
  if (received != count) {
    return false;
  }

  for (uint8_t i = 0; i < count; i++) {
    data[i] = Wire.read();
  }

  return true;
}

float lowPass(float oldValue, float newValue) {
  return oldValue + alpha * (newValue - oldValue);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  delay(200);

  writeRegister(0x6B, 0x00);
  delay(50);
  writeRegister(0x1B, 0x08);
  delay(10);
  writeRegister(0x1C, 0x10);
  delay(10);

  setupBle();
  Serial.println("SmartShirt stream ready (Serial + BLE)");
}

void loop() {
  uint8_t rawData[14];

  if (!readRegisters(0x3B, 14, rawData)) {
    delay(30);
    return;
  }

  accelX = (int16_t)((rawData[0] << 8) | rawData[1]);
  accelY = (int16_t)((rawData[2] << 8) | rawData[3]);
  accelZ = (int16_t)((rawData[4] << 8) | rawData[5]);

  gyroX = (int16_t)((rawData[8] << 8) | rawData[9]);
  gyroY = (int16_t)((rawData[10] << 8) | rawData[11]);
  gyroZ = (int16_t)((rawData[12] << 8) | rawData[13]);

  int leftRaw = analogRead(FLEX_LEFT);
  int rightRaw = analogRead(FLEX_RIGHT);

  filteredLeft = lowPass(filteredLeft, leftRaw);
  filteredRight = lowPass(filteredRight, rightRaw);
  filteredAX = lowPass(filteredAX, accelX);
  filteredAY = lowPass(filteredAY, accelY);
  filteredAZ = lowPass(filteredAZ, accelZ);
  filteredGX = lowPass(filteredGX, gyroX);
  filteredGY = lowPass(filteredGY, gyroY);
  filteredGZ = lowPass(filteredGZ, gyroZ);

  String line = "L:" + String((int)filteredLeft) +
                ",R:" + String((int)filteredRight) +
                ",AX:" + String((int)filteredAX) +
                ",AY:" + String((int)filteredAY) +
                ",AZ:" + String((int)filteredAZ) +
                ",GX:" + String((int)filteredGX) +
                ",GY:" + String((int)filteredGY) +
                ",GZ:" + String((int)filteredGZ);

  Serial.println(line);

  if (bleClientConnected && txCharacteristic != nullptr) {
    txCharacteristic->setValue(line.c_str());
    txCharacteristic->notify();
  }

  delay(35);
}
