// Particle Trail - mouse-following particles with fade effect

let particles = [];
let maxParticles = 100;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
}

function draw() {
  background(0, 0.05); // Fade effect with low opacity
  
  // Add new particle at mouse position
  if (mouseIsPressed) {
    for (let i = 0; i < 3; i++) {
      particles.push(new Particle(mouseX, mouseY));
    }
  } else {
    particles.push(new Particle(mouseX, mouseY));
  }
  
  // Limit particle count
  if (particles.length > maxParticles) {
    particles.splice(0, particles.length - maxParticles);
  }
  
  // Update and display particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].display();
    
    // Remove dead particles
    if (particles[i].isDead()) {
      particles.splice(i, 1);
    }
  }
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Move mouse • Click for more particles', 10, 20);
  text(`Particles: ${particles.length}`, 10, 35);
  colorMode(HSB);
}

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = random(5, 15);
    this.speed = random(1, 3);
    this.angle = random(TWO_PI);
    this.hue = random(360);
    this.life = 255;
    this.decay = random(2, 5);
  }
  
  update() {
    this.x += cos(this.angle) * this.speed;
    this.y += sin(this.angle) * this.speed;
    this.angle += random(-0.1, 0.1);
    this.life -= this.decay;
    this.size *= 0.98;
  }
  
  display() {
    noStroke();
    fill(this.hue, 80, 100, this.life / 255);
    ellipse(this.x, this.y, this.size);
  }
  
  isDead() {
    return this.life <= 0 || this.size < 0.5;
  }
}
