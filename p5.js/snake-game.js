// Snake Game - classic snake mechanics

let snake = [];
let food;
let gridSize = 20;
let direction = 'RIGHT';
let score = 0;
let gameOver = false;

function setup() {
  createCanvas(600, 400);
  frameRate(10);
  resetGame();
}

function draw() {
  background(30);
  
  if (gameOver) {
    fill(200);
    noStroke();
    textSize(32);
    textAlign(CENTER);
    text('GAME OVER', width / 2, height / 2 - 20);
    textSize(16);
    text('Press SPACE to restart', width / 2, height / 2 + 20);
    text(`Score: ${score}`, width / 2, height / 2 + 50);
    return;
  }
  
  // Move snake
  moveSnake();
  
  // Check food collision
  if (snake[0].x === food.x && snake[0].y === food.y) {
    score++;
    placeFood();
  } else {
    snake.pop();
  }
  
  // Check self collision
  for (let i = 1; i < snake.length; i++) {
    if (snake[0].x === snake[i].x && snake[0].y === snake[i].y) {
      gameOver = true;
    }
  }
  
  // Check wall collision
  if (snake[0].x < 0 || snake[0].x >= width || snake[0].y < 0 || snake[0].y >= height) {
    gameOver = true;
  }
  
  // Draw food
  fill(255, 100, 100);
  noStroke();
  ellipse(food.x + gridSize / 2, food.y + gridSize / 2, gridSize - 4);
  
  // Draw snake
  for (let i = 0; i < snake.length; i++) {
    fill(100, 255, 100);
    noStroke();
    rect(snake[i].x, snake[i].y, gridSize, gridSize);
  }
  
  // Score
  fill(200);
  noStroke();
  textSize(16);
  textAlign(LEFT);
  text(`Score: ${score}`, 10, 25);
  text('Arrow keys to move', 10, 45);
}

function moveSnake() {
  let head = { x: snake[0].x, y: snake[0].y };
  
  if (direction === 'UP') head.y -= gridSize;
  if (direction === 'DOWN') head.y += gridSize;
  if (direction === 'LEFT') head.x -= gridSize;
  if (direction === 'RIGHT') head.x += gridSize;
  
  snake.unshift(head);
}

function placeFood() {
  food = {
    x: floor(random(width / gridSize)) * gridSize,
    y: floor(random(height / gridSize)) * gridSize
  };
}

function resetGame() {
  snake = [{ x: 100, y: 100 }];
  placeFood();
  direction = 'RIGHT';
  score = 0;
  gameOver = false;
}

function keyPressed() {
  if (gameOver && key === ' ') {
    resetGame();
    return;
  }
  
  if (keyCode === UP_ARROW && direction !== 'DOWN') direction = 'UP';
  if (keyCode === DOWN_ARROW && direction !== 'UP') direction = 'DOWN';
  if (keyCode === LEFT_ARROW && direction !== 'RIGHT') direction = 'LEFT';
  if (keyCode === RIGHT_ARROW && direction !== 'LEFT') direction = 'RIGHT';
}
