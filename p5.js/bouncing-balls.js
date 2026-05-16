// Bouncing Balls - physics demo with gravity, collision, mouse interaction

let balls = [];

function setup() {
  createCanvas(600, 400);
  
  // Create initial balls
  for (let i = 0; i < 10; i++) {
    balls.push(new Ball(random(width), random(height / 2), random(20, 40)));
  }
}

function draw() {
  background(30);
  
  // Update and display all balls
  for (let ball of balls) {
    ball.update();
    ball.display();
  }
  
  // Instructions
  fill(200);
  noStroke();
  textSize(12);
  text('Click to add balls • Press SPACE to clear', 10, 20);
  text(`Balls: ${balls.length}`, 10, 35);
}

function mousePressed() {
  // Add new ball at mouse position
  balls.push(new Ball(mouseX, mouseY, random(20, 40)));
}

function keyPressed() {
  if (key === ' ') {
    balls = [];
  }
}

class Ball {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.vx = random(-3, 3);
    this.vy = random(-2, 2);
    this.gravity = 0.2;
    this.friction = 0.99;
    this.color = color(random(100, 255), random(100, 255), random(100, 255));
  }
  
  update() {
    // Apply gravity
    this.vy += this.gravity;
    
    // Apply friction
    this.vx *= this.friction;
    this.vy *= this.friction;
    
    // Update position
    this.x += this.vx;
    this.y += this.vy;
    
    // Bounce off walls
    if (this.x < this.size / 2) {
      this.x = this.size / 2;
      this.vx *= -0.8;
    }
    if (this.x > width - this.size / 2) {
      this.x = width - this.size / 2;
      this.vx *= -0.8;
    }
    
    // Bounce off floor
    if (this.y > height - this.size / 2) {
      this.y = height - this.size / 2;
      this.vy *= -0.8;
      
      // Stop bouncing if velocity is very low
      if (abs(this.vy) < 0.5) {
        this.vy = 0;
      }
    }
    
    // Bounce off ceiling
    if (this.y < this.size / 2) {
      this.y = this.size / 2;
      this.vy *= -0.8;
    }
    
    // Mouse repulsion
    let d = dist(this.x, this.y, mouseX, mouseY);
    if (d < 100 && mouseIsPressed) {
      let angle = atan2(this.y - mouseY, this.x - mouseX);
      let force = map(d, 0, 100, 5, 0);
      this.vx += cos(angle) * force;
      this.vy += sin(angle) * force;
    }
  }
  
  display() {
    fill(this.color);
    noStroke();
    ellipse(this.x, this.y, this.size);
  }
}
