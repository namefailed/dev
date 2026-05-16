// Spirograph - geometric spirograph with variable parameters

let t = 0;
let R = 100; // Outer radius
let r = 30;  // Inner radius
let d = 50;  // Distance from inner circle center

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(220, 80, 10);
  
  translate(width / 2, height / 2);
  
  // Draw spirograph
  noFill();
  let hue = (t * 10) % 360;
  stroke(hue, 80, 100);
  strokeWeight(2);
  
  beginShape();
  for (let angle = 0; angle <= TWO_PI * 10; angle += 0.01) {
    let x = (R - r) * cos(angle) + d * cos(((R - r) / r) * angle);
    let y = (R - r) * sin(angle) - d * sin(((R - r) / r) * angle);
    vertex(x, y);
  }
  endShape();
  
  t += 0.01;
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Spirograph: click to randomize parameters', -280, -180);
  text(`R=${R.toFixed(0)} r=${r.toFixed(0)} d=${d.toFixed(0)}`, -280, -165);
  colorMode(HSB);
}

function mousePressed() {
  R = random(50, 150);
  r = random(10, 50);
  d = random(10, 80);
}

function keyPressed() {
  if (key === ' ') {
    R = 100;
    r = 30;
    d = 50;
  }
}
