// Conway's Game of Life - cellular automaton simulation

let grid;
let cols = 60;
let rows = 40;
let resolution = 10;
let running = true;

function setup() {
  createCanvas(600, 400);
  frameRate(10);
  cols = width / resolution;
  rows = height / resolution;
  grid = createGrid(cols, rows);
  randomizeGrid();
}

function draw() {
  background(30);
  
  // Draw grid
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (grid[i][j] === 1) {
        fill(100, 255, 100);
        noStroke();
        rect(i * resolution, j * resolution, resolution - 1, resolution - 1);
      }
    }
  }
  
  // Update grid
  if (running) {
    let next = createGrid(cols, rows);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        let state = grid[i][j];
        let neighbors = countNeighbors(grid, i, j);
        
        if (state === 0 && neighbors === 3) {
          next[i][j] = 1;
        } else if (state === 1 && (neighbors < 2 || neighbors > 3)) {
          next[i][j] = 0;
        } else {
          next[i][j] = state;
        }
      }
    }
    grid = next;
  }
  
  // Instructions
  fill(200);
  noStroke();
  textSize(12);
  text('Game of Life', 10, 20);
  text('Click to toggle cells', 10, 35);
  text('SPACE: pause/resume', 10, 50);
  text('R: randomize', 10, 65);
  text('C: clear', 10, 80);
  text(`Running: ${running}`, 10, 95);
}

function createGrid(cols, rows) {
  let arr = new Array(cols);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = new Array(rows).fill(0);
  }
  return arr;
}

function randomizeGrid() {
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      grid[i][j] = random() > 0.85 ? 1 : 0;
    }
  }
}

function countNeighbors(grid, x, y) {
  let sum = 0;
  for (let i = -1; i < 2; i++) {
    for (let j = -1; j < 2; j++) {
      let col = (x + i + cols) % cols;
      let row = (y + j + rows) % rows;
      sum += grid[col][row];
    }
  }
  sum -= grid[x][y];
  return sum;
}

function mousePressed() {
  let i = floor(mouseX / resolution);
  let j = floor(mouseY / resolution);
  if (i >= 0 && i < cols && j >= 0 && j < rows) {
    grid[i][j] = grid[i][j] ? 0 : 1;
  }
}

function keyPressed() {
  if (key === ' ') running = !running;
  if (key === 'r' || key === 'R') randomizeGrid();
  if (key === 'c' || key === 'C') grid = createGrid(cols, rows);
}
