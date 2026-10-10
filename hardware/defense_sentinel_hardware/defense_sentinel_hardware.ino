
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// HC-SR04
#define TRIG_PIN 5
#define ECHO_PIN 18

// PIR motion sensor
#define PIR_PIN 16

// OLED display
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET
);

float distanceCm = -1;
bool motionDetected = false;

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PIR_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED not detected. Check wiring/address.");
    while (true) {
      delay(100);
    }
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("DEFENSE SENTINEL");
  display.println("----------------");
  display.println("Starting sensors...");
  display.display();

  Serial.println("DEFENSE SENTINEL");
  Serial.println("Ultrasonic + PIR + OLED");
}

float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    return -1;
  }

  return duration * 0.0343f / 2.0f;
}

void loop() {
  distanceCm = readDistance();
  motionDetected = (digitalRead(PIR_PIN) == HIGH);

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
  } else if (distanceCm > 0 && distanceCm < 100) {
    display.println("Status: OBJECT NEAR");
  } else {
    display.println("Status: MONITORING");
  }

  display.display();

  Serial.print("Distance: ");
  if (distanceCm < 0) {
    Serial.print("No echo");
  } else {
    Serial.print(distanceCm, 1);
    Serial.print(" cm");
  }

  Serial.print(" | Motion: ");
  Serial.println(motionDetected ? "DETECTED" : "NONE");

  delay(300);
}