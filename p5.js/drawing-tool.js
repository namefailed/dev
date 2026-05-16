// Drawing Tool - brush with size/color controls

let brushSize = 20;
let brushColor;
let previousMouseX, previousMouseY;

function setup() {
  createCanvas(600, 400);
  background(255);
  brushColor = color(0);
  colorMode(HSB);
}

function draw() {
  if (mouseIsPressed) {
    stroke(brushColor);
    strokeWeight(brushSize);
    strokeCap(ROUND);
    line(previousMouseX, previousMouseY, mouseX, mouseY);
  }
  
  previousMouseX = mouseX;
  previousMouseY = mouseY;
  
  // UI panel
  fill(0, 0, 95);
  noStroke();
  rect(0, 0, 200, 100);
  
  fill(0);
  noStroke();
  textSize(12);
  textAlign(LEFT);
  text(`Brush size: ${brushSize}`, 10, 20);
  text('Press 1-5 for size', 10, 35);
  text('Click color swatches', 10, 50);
  text('Press C to clear', 10, 65);
  text('Press S to save', 10, 80);
  
  // Color swatches
  drawColorSwatch(10, 90, color(0));
  drawColorSwatch(40, 90, color(0, 100, 100));
  drawColorSwatch(70, 90, color(120, 100, 100));
  drawColorSwatch(100, 90, color(240, 100, 100));
  drawColorSwatch(130, 90, color(0, 0, 100));
}

function drawColorSwatch(x, y, c) {
  fill(c);
  noStroke();
  rect(x, y, 25, 25);
  if (brushColor.toString() === c.toString()) {
    stroke(0);
    strokeWeight(2);
    noFill();
    rect(x - 2, y - 2, 29, 29);
  }
}

function mousePressed() {
  // Check color swatches
  let swatchColors = [
    color(0),
    color(0, 100, 100),
    color(120, 100, 100),
    color(240, 100, 100),
    color(0, 0, 100)
  ];
  let swatchX = [10, 40, 70, 100, 130];
  
  for (let i = 0; i < swatchX.length; i++) {
    if (mouseX > swatchX[i] && mouseX < swatchX[i] + 25 && mouseY > 90 && mouseY < 115) {
      brushColor = swatchColors[i];
    }
  }
}

function keyPressed() {
  if (key === '1') brushSize = 10;
  if (key === '2') brushSize = 20;
  if (key === '3') brushSize = 30;
  if (key === '4') brushSize = 40;
  if (key === '5') brushSize = 50;
  if (key === 'c' || key === 'C') background(255);
  if (key === 's' || key === 'S') saveCanvas('drawing', 'png');
}
