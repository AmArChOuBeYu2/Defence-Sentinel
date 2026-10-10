#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// HC-SR04 Ultrasonic Distance Sensor Pins
#define TRIG_PIN 5
#define ECHO_PIN 18

// HC-SR501 PIR Motion Sensor Pin
#define PIR_PIN 16

// SSD1306 128x64 I2C OLED Display
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET
);

float distanceCm = -1.0f;
bool motionDetected = false;

void setup() {
  // 115200 Baud rate for Web Serial API & Serial Monitor
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PIR_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED not detected. Check I2C wiring (SDA=21, SCL=22, ADDR=0x3C).");
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("DEFENSE SENTINEL");
    display.println("----------------");
    display.println("Starting sensors...");
    display.display();
  }

  // Send READY handshake signal to Web Serial frontend
  Serial.println("READY");
}

float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout (~5m max range)

  if (duration == 0) {
    return -1.0f; // No echo pulse returned
  }

  return (duration * 0.0343f) / 2.0f;
}

void loop() {
  distanceCm = readDistance();
  motionDetected = (digitalRead(PIR_PIN) == HIGH);

  // 1. OLED Display Update
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("DEFENSE SENTINEL");
  display.drawLine(0, 11, 127, 11, SSD1306_WHITE);

  display.setCursor(0, 17);
  display.print("Distance: ");
  if (distanceCm < 0) {
    display.println("No echo");
  } else {
    display.print(distanceCm, 1);
    display.println(" cm");
  }

  display.setCursor(0, 31);
  display.print("Motion: ");
  display.println(motionDetected ? "DETECTED" : "NONE");

  display.setCursor(0, 45);
  if (motionDetected) {
    display.println("Status: MOTION ALERT");
  } else if (distanceCm > 0 && distanceCm < 50) {
    display.println("Status: INTRUSION <50cm");
  } else if (distanceCm >= 50 && distanceCm < 100) {
    display.println("Status: OBJECT NEAR");
  } else {
    display.println("Status: MONITORING");
  }

  display.display();

  // 2. Serial Telemetry Protocol Output (115200 Baud)
  int pirVal = motionDetected ? 1 : 0;
  
  if (motionDetected || (distanceCm > 0 && distanceCm < 50)) {
    // Intrusion / Alert Telemetry Line: ALERT,angle,distance_cm,pir
    Serial.print("ALERT,0,");
    if (distanceCm < 0) Serial.print("300.0"); else Serial.print(distanceCm, 1);
    Serial.print(",");
    Serial.println(pirVal);
  } else {
    // Standard Telemetry Line: DATA,angle,distance_cm,pir
    Serial.print("DATA,0,");
    if (distanceCm < 0) Serial.print("-1.0"); else Serial.print(distanceCm, 1);
    Serial.print(",");
    Serial.println(pirVal);
  }

  delay(200);
}