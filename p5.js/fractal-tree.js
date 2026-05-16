// Fractal Tree - recursive branching tree with wind effect

let angle = PI / 4;
let len = 100;
let windOffset = 0;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(220, 80, 10);
  
  translate(width / 2, height);
  
  // Update wind
  windOffset = sin(frameCount * 0.02) * 0.1;
  
  // Draw tree
  stroke(30, 80, 80);
  strokeWeight(2);
  branch(len);
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Fractal tree with wind effect', -280, -370);
  text('Click to randomize angle', -280, -355);
  text(`Angle: ${nf(angle * 180 / PI, 1, 1)}°`, -280, -340);
  colorMode(HSB);
}

function branch(len) {
  line(0, 0, 0, -len);
  translate(0, -len);
  
  if (len > 4) {
    let newLen = len * 0.67;
    
    push();
    rotate(angle + windOffset);
    stroke(30, 80, 90);
    branch(newLen);
    pop();
    
    push();
    rotate(-angle + windOffset);
    stroke(30, 80, 85);
    branch(newLen);
    pop();
  }
}

function mousePressed() {
  angle = random(PI / 6, PI / 3);
}

function keyPressed() {
  if (key === ' ') {
    angle = PI / 4;
  }
}
