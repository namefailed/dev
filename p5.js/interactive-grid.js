// Interactive Grid - grid of cells that change on hover/click

let cols = 20;
let rows = 15;
let cellSize = 30;
let grid = [];

function setup() {
  createCanvas(cols * cellSize, rows * cellSize);
  colorMode(HSB);
  
  // Initialize grid
  for (let i = 0; i < cols; i++) {
    grid[i] = [];
    for (let j = 0; j < rows; j++) {
      grid[i][j] = {
        hue: random(360),
        saturation: 80,
        brightness: 100,
        active: false
      };
    }
  }
}

function draw() {
  background(220, 80, 10);
  
  // Draw grid
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      let x = i * cellSize;
      let y = j * cellSize;
      let cell = grid[i][j];
      
      // Check if mouse is over this cell
      if (mouseX > x && mouseX < x + cellSize &&
          mouseY > y && mouseY < y + cellSize) {
        cell.active = true;
        cell.hue = (cell.hue + 1) % 360;
      }
      
      // Draw cell
      stroke(0);
      strokeWeight(1);
      fill(cell.hue, cell.saturation, cell.brightness);
      rect(x, y, cellSize, cellSize);
    }
  }
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Hover to change colors • Click to randomize all', 10, 15);
  colorMode(HSB);
}

function mousePressed() {
  // Randomize entire grid
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      grid[i][j].hue = random(360);
      grid[i][j].saturation = random(50, 100);
      grid[i][j].brightness = random(80, 100);
    }
  }
}

function keyPressed() {
  if (key === ' ') {
    // Reset to default colors
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        grid[i][j].hue = random(360);
        grid[i][j].saturation = 80;
        grid[i][j].brightness = 100;
      }
    }
  }
}
