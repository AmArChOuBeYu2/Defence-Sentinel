#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SPI.h>
#include <MFRC522.h>

// ============================================================
// DEFENSE SENTINEL - ESP32 HARDWARE FIRMWARE
// ============================================================

// -------------------- PIN DEFINITIONS -----------------------

// HC-SR04
#define TRIG_PIN 5
#define ECHO_PIN 18

// 28BYJ-48 + ULN2003
#define IN1 14
#define IN2 27
#define IN3 26
#define IN4 33

// PIR
#define PIR_PIN 16

// OLED I2C
#define OLED_SDA 21
#define OLED_SCL 22

// RED LED
// GPIO12 and GPIO2 caused upload/boot problems in your setup.
// GPIO13 is being used here.
#define RED_LED_PIN 13

// RC522
#define RFID_SS_PIN 4
#define RFID_RST_PIN 32
#define RFID_SCK_PIN 25
#define RFID_MOSI_PIN 23
#define RFID_MISO_PIN 17

// -------------------- OLED -------------------------------

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);

// -------------------- RFID -------------------------------

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// -------------------- STEPPER ----------------------------

const int stepSequence[8][4] = {
  {1, 0, 0, 1},
  {0, 0, 0, 1},
  {0, 1, 0, 1},
  {0, 1, 0, 0},
  {0, 1, 1, 0},
  {0, 0, 1, 0},
  {1, 0, 1, 0},
  {1, 0, 0, 0}
};

int stepIndex = 0;

// Approximate physical scan range
int currentAngle = 0;
int scanDirection = 1;

// Approximate steps-per-degree.
// Tune this if your physical 180° sweep is not exactly 180°.
const float STEPS_PER_DEGREE = 11.4;

int stepsSinceAngleUpdate = 0;

// -------------------- DISTANCE ----------------------------

float distanceCm = 300.0;

const float ALERT_DISTANCE = 50.0;
const float CLEAR_DISTANCE = 55.0;

// Debouncing
int alertCounter = 0;
int clearCounter = 0;

bool intrusionAlert = false;

// -------------------- PIR -------------------------------

int pirState = 0;

// -------------------- RFID -------------------------------

String lastRFID = "";
unsigned long lastRFIDTime = 0;

// -------------------- TIMING -----------------------------

unsigned long lastSensorRead = 0;
unsigned long lastTelemetry = 0;
unsigned long lastOLED = 0;

const unsigned long SENSOR_INTERVAL = 60;
const unsigned long TELEMETRY_INTERVAL = 100;
const unsigned long OLED_INTERVAL = 150;

// ============================================================
// STEPPER FUNCTIONS
// ============================================================

void applyStep(int index) {

  digitalWrite(IN1, stepSequence[index][0]);
  digitalWrite(IN2, stepSequence[index][1]);
  digitalWrite(IN3, stepSequence[index][2]);
  digitalWrite(IN4, stepSequence[index][3]);
}

void stepMotor(int direction) {

  stepIndex += direction;

  if (stepIndex > 7) stepIndex = 0;
  if (stepIndex < 0) stepIndex = 7;

  applyStep(stepIndex);

  delayMicroseconds(3000);
}

void updateScanner() {

  static int stepCounter = 0;

  stepMotor(scanDirection);

  stepCounter++;

  if (stepCounter >= STEPS_PER_DEGREE) {

    stepCounter = 0;

    currentAngle += scanDirection;

    if (currentAngle >= 180) {
      currentAngle = 180;
      scanDirection = -1;
    }

    if (currentAngle <= 0) {
      currentAngle = 0;
      scanDirection = 1;
    }
  }
}

// ============================================================
// HC-SR04
// ============================================================

float readDistance() {

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration =
    pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    return 300.0;
  }

  float distance =
    (duration * 0.0343) / 2.0;

  if (distance < 2 || distance > 300) {
    return 300.0;
  }

  return distance;
}

// ============================================================
// ALERT LOGIC
// ============================================================

void updateAlert() {

  // Object clearly inside alert distance
  if (distanceCm > 0 &&
      distanceCm < ALERT_DISTANCE) {

    alertCounter++;
    clearCounter = 0;

    // Require two consecutive readings
    if (alertCounter >= 2) {

      if (!intrusionAlert) {

        intrusionAlert = true;

        Serial.print("ALERT,");
        Serial.print(currentAngle);
        Serial.print(",");
        Serial.println(distanceCm, 1);
      }
    }
  }

  // Object moved sufficiently far away
  else if (distanceCm >= CLEAR_DISTANCE) {

    clearCounter++;
    alertCounter = 0;

    // Require several clear readings
    if (clearCounter >= 3) {

      if (intrusionAlert) {

        intrusionAlert = false;

        Serial.print("CLEAR,");
        Serial.print(currentAngle);
        Serial.print(",");
        Serial.println(distanceCm, 1);
      }
    }
  }

  else {

    alertCounter = 0;
    clearCounter = 0;
  }

  digitalWrite(
    RED_LED_PIN,
    intrusionAlert ? HIGH : LOW
  );
}

// ============================================================
// RFID
// ============================================================

String readRFID() {

  if (!rfid.PICC_IsNewCardPresent()) {
    return "";
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return "";
  }

  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      uid += "0";
    }

    uid += String(
      rfid.uid.uidByte[i],
      HEX
    );

    if (i < rfid.uid.size - 1) {
      uid += ":";
    }
  }

  uid.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  return uid;
}

// ============================================================
// OLED
// ============================================================

void updateOLED() {

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("DEFENSE SENTINEL");

  display.drawLine(
    0, 10,
    127, 10,
    SSD1306_WHITE
  );

  if (intrusionAlert) {

    display.setTextSize(2);

    display.setCursor(20, 17);
    display.println("ALERT");

    display.setTextSize(1);

    display.setCursor(0, 40);

    display.print("DIST: ");
    display.print(distanceCm, 1);
    display.println(" cm");

    display.setCursor(0, 52);

    display.print("ANGLE: ");
    display.print(currentAngle);
    display.println(" deg");

  } else {

    display.setTextSize(1);

    display.setCursor(0, 17);
    display.println("STATUS: SCANNING");

    display.setCursor(0, 30);

    display.print("Distance: ");
    display.print(distanceCm, 1);
    display.println(" cm");

    display.setCursor(0, 42);

    display.print("Angle: ");
    display.print(currentAngle);
    display.println(" deg");

    display.setCursor(0, 54);

    display.print("PIR: ");
    display.print(pirState ? "MOTION" : "CLEAR");
  }

  display.display();
}

// ============================================================
// SERIAL TELEMETRY
// ============================================================

void sendTelemetry() {

  /*
    Format:

    DATA,<angle>,<distance>,<pir>,<rfid>

    Example:

    DATA,73,42.5,1,NO_TAG
  */

  Serial.print("DATA,");
  Serial.print(currentAngle);
  Serial.print(",");
  Serial.print(distanceCm, 1);
  Serial.print(",");
  Serial.print(pirState);
  Serial.print(",");

  if (lastRFID.length() > 0 &&
      millis() - lastRFIDTime < 5000) {

    Serial.println(lastRFID);

  } else {

    Serial.println("NO_TAG");
  }
}

// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(500);

  // ---------------- HC-SR04 ----------------

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  // ---------------- STEPPER ----------------

  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  applyStep(0);

  // ---------------- PIR ----------------

  pinMode(PIR_PIN, INPUT);

  // ---------------- RED LED ----------------

  pinMode(RED_LED_PIN, OUTPUT);

  digitalWrite(
    RED_LED_PIN,
    LOW
  );

  // ---------------- OLED ----------------

  Wire.begin(
    OLED_SDA,
    OLED_SCL
  );

  if (!display.begin(
        SSD1306_SWITCHCAPVCC,
        0x3C
      )) {

    Serial.println(
      "OLED ERROR"
    );

  } else {

    display.clearDisplay();

    display.setTextColor(
      SSD1306_WHITE
    );

    display.setTextSize(1);

    display.setCursor(0, 0);
    display.println(
      "DEFENSE SENTINEL"
    );

    display.setCursor(0, 20);
    display.println(
      "INITIALIZING..."
    );

    display.display();

    delay(1000);
  }

  // ---------------- RFID ----------------

  SPI.begin(
    RFID_SCK_PIN,
    RFID_MISO_PIN,
    RFID_MOSI_PIN,
    RFID_SS_PIN
  );

  rfid.PCD_Init();

  delay(100);

  // ---------------- READY ----------------

  Serial.println(
    "DEFENSE SENTINEL READY"
  );

  Serial.println(
    "READY"
  );

  display.clearDisplay();

  display.setTextColor(
    SSD1306_WHITE
  );

  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println(
    "SYSTEM READY"
  );

  display.setCursor(0, 20);
  display.println(
    "Scanning 0-180 deg"
  );

  display.setCursor(0, 35);
  display.println(
    "Threshold: 50 cm"
  );

  display.display();

  delay(1000);
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {

  unsigned long now = millis();

  // ----------------------------------------------------------
  // MOTOR
  // ----------------------------------------------------------

  updateScanner();

  // ----------------------------------------------------------
  // SENSOR READING
  // ----------------------------------------------------------

  if (now - lastSensorRead >= SENSOR_INTERVAL) {

    lastSensorRead = now;

    distanceCm = readDistance();

    pirState = digitalRead(PIR_PIN);

    updateAlert();

    String tag = readRFID();

    if (tag.length() > 0) {

      lastRFID = tag;
      lastRFIDTime = now;

      Serial.print("RFID,");
      Serial.print(currentAngle);
      Serial.print(",");
      Serial.println(tag);
    }
  }

  // ----------------------------------------------------------
  // TELEMETRY
  // ----------------------------------------------------------

  if (now - lastTelemetry >= TELEMETRY_INTERVAL) {

    lastTelemetry = now;

    sendTelemetry();
  }

  // ----------------------------------------------------------
  // OLED
  // ----------------------------------------------------------

  if (now - lastOLED >= OLED_INTERVAL) {

    lastOLED = now;

    updateOLED();
  }
}