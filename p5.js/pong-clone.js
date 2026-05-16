// Pong Clone - simple paddle game

let paddleWidth = 10;
let paddleHeight = 80;
let paddleSpeed = 8;

let leftY, rightY;
let ballX, ballY;
let ballSpeedX, ballSpeedY;
let leftScore = 0;
let rightScore = 0;

function setup() {
  createCanvas(600, 400);
  leftY = height / 2 - paddleHeight / 2;
  rightY = height / 2 - paddleHeight / 2;
  resetBall();
}

function draw() {
  background(30);
  
  // Center line
  stroke(100);
  strokeWeight(2);
  for (let i = 0; i < height; i += 20) {
    line(width / 2, i, width / 2, i + 10);
  }
  
  // Paddles
  fill(200);
  noStroke();
  rect(10, leftY, paddleWidth, paddleHeight);
  rect(width - 20, rightY, paddleWidth, paddleHeight);
  
  // Ball
  fill(255);
  ellipse(ballX, ballY, 15);
  
  // Move paddles
  if (keyIsDown(87)) leftY -= paddleSpeed; // W
  if (keyIsDown(83)) leftY += paddleSpeed; // S
  if (keyIsDown(UP_ARROW)) rightY -= paddleSpeed;
  if (keyIsDown(DOWN_ARROW)) rightY += paddleSpeed;
  
  // Constrain paddles
  leftY = constrain(leftY, 0, height - paddleHeight);
  rightY = constrain(rightY, 0, height - paddleHeight);
  
  // Move ball
  ballX += ballSpeedX;
  ballY += ballSpeedY;
  
  // Ball collision with top/bottom
  if (ballY < 7.5 || ballY > height - 7.5) {
    ballSpeedY *= -1;
  }
  
  // Ball collision with left paddle
  if (ballX < 20 + paddleWidth && ballY > leftY && ballY < leftY + paddleHeight) {
    ballSpeedX = abs(ballSpeedX);
    ballSpeedX *= 1.05;
  }
  
  // Ball collision with right paddle
  if (ballX > width - 20 - paddleWidth && ballY > rightY && ballY < rightY + paddleHeight) {
    ballSpeedX = -abs(ballSpeedX);
    ballSpeedX *= 1.05;
  }
  
  // Scoring
  if (ballX < 0) {
    rightScore++;
    resetBall();
  }
  if (ballX > width) {
    leftScore++;
    resetBall();
  }
  
  // Score display
  fill(200);
  textSize(32);
  textAlign(CENTER);
  text(leftScore, width / 4, 40);
  text(rightScore, 3 * width / 4, 40);
  
  // Instructions
  textSize(12);
  text('W/S: left paddle | Arrows: right paddle', width / 2, height - 20);
}

function resetBall() {
  ballX = width / 2;
  ballY = height / 2;
  ballSpeedX = random() > 0.5 ? 5 : -5;
  ballSpeedY = random(-3, 3);
}

function keyPressed() {
  if (key === ' ') {
    leftScore = 0;
    rightScore = 0;
  }
}
