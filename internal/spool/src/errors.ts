export class SpoolFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpoolFormatError'
  }
}
