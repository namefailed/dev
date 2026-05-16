// Terrain Generator - 3D terrain using noise

let cols = 40;
let rows = 40;
let scl = 20;
let w, h;
let terrain = [];

function setup() {
  createCanvas(600, 400, WEBGL);
  w = cols * scl;
  h = rows * scl;
  
  let yoff = 0;
  for (let y = 0; y < rows; y++) {
    terrain[y] = [];
    let xoff = 0;
    for (let x = 0; x < cols; x++) {
      terrain[y][x] = map(noise(xoff, yoff), 0, 1, -100, 100);
      xoff += 0.1;
    }
    yoff += 0.1;
  }
}

function draw() {
  background(30);
  
  // Lighting
  ambientLight(100);
  directionalLight(255, 255, 255, 0.5, 0.5, -1);
  
  // Rotate terrain
  rotateX(PI / 3);
  translate(-w / 2, -h / 2);
  
  // Draw terrain
  noFill();
  stroke(100, 150, 255);
  strokeWeight(1);
  
  for (let y = 0; y < rows - 1; y++) {
    beginShape(TRIANGLE_STRIP);
    for (let x = 0; x < cols; x++) {
      vertex(x * scl, y * scl, terrain[y][x]);
      vertex(x * scl, (y + 1) * scl, terrain[y + 1][x]);
    }
    endShape();
  }
  
  // Instructions (2D overlay)
  push();
  resetMatrix();
  camera();
  noLights();
  fill(200);
  noStroke();
  textSize(12);
  text('3D terrain using Perlin noise', -280, -180);
  text('Click to regenerate', -280, -165);
  pop();
}

function mousePressed() {
  let yoff = 0;
  for (let y = 0; y < rows; y++) {
    let xoff = 0;
    for (let x = 0; x < cols; x++) {
      terrain[y][x] = map(noise(xoff, yoff), 0, 1, -100, 100);
      xoff += 0.1;
    }
    yoff += 0.1;
  }
}
