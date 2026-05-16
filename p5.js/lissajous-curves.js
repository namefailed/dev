// Lissajous Curves - complex harmonic motion patterns

let t = 0;
let a = 3;
let b = 2;
let delta = PI / 2;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(220, 80, 10);
  
  translate(width / 2, height / 2);
  
  // Draw multiple Lissajous curves with different parameters
  let numCurves = 5;
  for (let i = 0; i < numCurves; i++) {
    let hue = map(i, 0, numCurves, 0, 360);
    let a_i = a + i * 0.5;
    let b_i = b + i * 0.3;
    let delta_i = delta + i * 0.2;
    
    drawLissajous(a_i, b_i, delta_i, hue, i);
  }
  
  t += 0.02;
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Lissajous curves: x = sin(at + δ), y = sin(bt)', -280, -180);
  text('Click to randomize parameters', -280, -165);
  colorMode(HSB);
}

function drawLissajous(a, b, delta, hue, index) {
  noFill();
  stroke(hue, 80, 100);
  strokeWeight(2);
  
  beginShape();
  for (let angle = 0; angle <= TWO_PI; angle += 0.01) {
    let x = 150 * sin(a * angle + delta);
    let y = 150 * sin(b * angle);
    vertex(x, y);
  }
  endShape();
}

function mousePressed() {
  a = random(1, 5);
  b = random(1, 5);
  delta = random(0, TWO_PI);
}

function keyPressed() {
  if (key === ' ') {
    a = 3;
    b = 2;
    delta = PI / 2;
  }
}
