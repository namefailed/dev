// Rotating Cube - 3D cube with lighting

function setup() {
  createCanvas(600, 400, WEBGL);
}

function draw() {
  background(30);
  
  // Lighting
  ambientLight(100);
  directionalLight(255, 255, 255, 0.5, 0.5, -1);
  pointLight(255, 255, 255, 0, 0, 200);
  
  // Rotate cube
  rotateX(frameCount * 0.01);
  rotateY(frameCount * 0.01);
  
  // Draw cube
  noStroke();
  fill(100, 150, 255);
  box(150);
  
  // Instructions (2D overlay)
  push();
  resetMatrix();
  camera();
  noLights();
  fill(200);
  noStroke();
  textSize(12);
  text('3D rotating cube with lighting', -280, -180);
  text('Move mouse to change rotation speed', -280, -165);
  pop();
}

function mouseMoved() {
  // Change rotation speed based on mouse position
  let speed = map(mouseX, 0, width, 0.005, 0.02);
}
