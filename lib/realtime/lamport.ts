export class LamportClock {
  private counter: number

  constructor(initialValue = 0) {
    this.counter = initialValue
  }

  public now() {
    return this.counter
  }

  public tick() {
    this.counter += 1
    return this.counter
  }

  public tickFromTimestamp(timestamp: number) {
    const value = Math.max(this.counter + 1, timestamp)
    this.counter = value
    return this.counter
  }

  public observe(value: number) {
    if (value > this.counter) {
      this.counter = value
    }
    return this.counter
  }
}
