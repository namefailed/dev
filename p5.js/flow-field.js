// Flow Field - perlin noise-driven particle flow

let particles = [];
let flowField;
let resolution = 20;
let cols, rows;
let zOff = 0;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
  
  cols = floor(width / resolution);
  rows = floor(height / resolution);
  
  // Initialize particles
  for (let i = 0; i < 500; i++) {
    particles.push(new Particle());
  }
}

function draw() {
  background(220, 80, 10, 0.1);
  
  // Calculate flow field
  let yOff = 0;
  for (let y = 0; y < rows; y++) {
    let xOff = 0;
    for (let x = 0; x < cols; x++) {
      let index = x + y * cols;
      let angle = noise(xOff, yOff, zOff) * TWO_PI * 4;
      let v = p5.Vector.fromAngle(angle);
      xOff += 0.1;
    }
    yOff += 0.1;
  }
  zOff += 0.003;
  
  // Update and display particles
  for (let particle of particles) {
    particle.update();
    particle.display();
    particle.edges();
  }
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Perlin noise flow field', 10, 20);
  text(`Particles: ${particles.length}`, 10, 35);
  colorMode(HSB);
}

class Particle {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.maxSpeed = 2;
    this.prevPos = this.pos.copy();
    this.hue = random(360);
  }
  
  update() {
    let x = floor(this.pos.x / resolution);
    let y = floor(this.pos.y / resolution);
    let xOff = x * 0.1;
    let yOff = y * 0.1;
    let angle = noise(xOff, yOff, zOff) * TWO_PI * 4;
    let force = p5.Vector.fromAngle(angle);
    this.acc.add(force);
    
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }
  
  display() {
    stroke(this.hue, 80, 100);
    strokeWeight(1);
    line(this.pos.x, this.pos.y, this.prevPos.x, this.prevPos.y);
    this.prevPos = this.pos.copy();
  }
  
  edges() {
    if (this.pos.x > width) {
      this.pos.x = 0;
      this.prevPos.x = 0;
    }
    if (this.pos.x < 0) {
      this.pos.x = width;
      this.prevPos.x = width;
    }
    if (this.pos.y > height) {
      this.pos.y = 0;
      this.prevPos.y = 0;
    }
    if (this.pos.y < 0) {
      this.pos.y = height;
      this.prevPos.y = height;
    }
  }
}
