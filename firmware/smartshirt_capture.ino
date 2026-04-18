#include <Wire.h>

#define I2C_SDA 18
#define I2C_SCL 22
#define MPU_ADDR 0x68
#define FLEX_LEFT 34
#define FLEX_RIGHT 35

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

  writeRegister(0x6B, 0x00); // wake up
  delay(50);
  writeRegister(0x1B, 0x08); // gyro +-500 dps
  delay(10);
  writeRegister(0x1C, 0x10); // accel +-8g
  delay(10);

  Serial.println("SmartShirt stream ready");
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

  // Format für App parser:
  // L:1234,R:1400,AX:20,AY:-300,AZ:16200,GX:10,GY:-4,GZ:2
  Serial.print("L:");
  Serial.print((int)filteredLeft);
  Serial.print(",R:");
  Serial.print((int)filteredRight);
  Serial.print(",AX:");
  Serial.print((int)filteredAX);
  Serial.print(",AY:");
  Serial.print((int)filteredAY);
  Serial.print(",AZ:");
  Serial.print((int)filteredAZ);
  Serial.print(",GX:");
  Serial.print((int)filteredGX);
  Serial.print(",GY:");
  Serial.print((int)filteredGY);
  Serial.print(",GZ:");
  Serial.println((int)filteredGZ);

  delay(35);
}
