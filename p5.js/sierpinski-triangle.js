// Sierpinski Triangle - classic fractal triangle

let depth = 5;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(220, 80, 10);
  
  translate(width / 2, height);
  
  // Draw sierpinski triangle
  let size = 300;
  sierpinski(size, depth);
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Sierpinski triangle fractal', -280, -370);
  text('Click to change depth', -280, -355);
  text(`Depth: ${depth}`, -280, -340);
  colorMode(HSB);
}

function sierpinski(size, d) {
  if (d === 0) {
    fill(random(360), 80, 100);
    noStroke();
    triangle(-size / 2, size / 2, size / 2, size / 2, 0, -size / 2);
  } else {
    let newSize = size / 2;
    sierpinski(newSize, d - 1);
    translate(-newSize, newSize / 2);
    sierpinski(newSize, d - 1);
    translate(newSize * 2, 0);
    sierpinski(newSize, d - 1);
    translate(-newSize, -newSize);
    translate(0, -newSize);
    sierpinski(newSize, d - 1);
    translate(0, newSize);
  }
}

function mousePressed() {
  depth = (depth + 1) % 7;
  if (depth === 0) depth = 1;
}

function keyPressed() {
  if (key === ' ') {
    depth = 5;
  }
}
