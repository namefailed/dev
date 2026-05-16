// Sine Wave Pattern - animated waves with color gradients

let t = 0;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(220, 80, 10);
  
  // Draw multiple sine waves
  let numWaves = 10;
  for (let i = 0; i < numWaves; i++) {
    let yOffset = map(i, 0, numWaves, 0, height);
    let hue = map(i, 0, numWaves, 0, 360);
    let amplitude = map(i, 0, numWaves, 50, 100);
    let frequency = map(i, 0, numWaves, 0.01, 0.03);
    
    drawSineWave(yOffset, hue, amplitude, frequency, i);
  }
  
  t += 0.02;
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Animated sine waves with color gradients', 10, 20);
  text('Press SPACE to pause/resume', 10, 35);
  colorMode(HSB);
}

function drawSineWave(yOffset, hue, amplitude, frequency, index) {
  noFill();
  stroke(hue, 80, 100);
  strokeWeight(2);
  
  beginShape();
  for (let x = 0; x <= width; x += 5) {
    let y = yOffset + sin(x * frequency + t + index) * amplitude;
    vertex(x, y);
  }
  endShape();
}

function keyPressed() {
  if (key === ' ') {
    if (isLooping()) {
      noLoop();
    } else {
      loop();
    }
  }
}
