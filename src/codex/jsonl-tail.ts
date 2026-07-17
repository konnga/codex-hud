import { Buffer } from 'node:buffer'
// @env node
import fs from 'node:fs'

export interface JsonlReadResult {
  lines: string[]
  reset: boolean
}

export class JsonlTail {
  private offset = 0
  private remainder = ''
  private inode: number | null = null

  reset(): void {
    this.offset = 0
    this.remainder = ''
    this.inode = null
  }

  read(filePath: string): JsonlReadResult {
    const stat = fs.statSync(filePath)
    const replaced = this.inode !== null && stat.ino !== this.inode
    const truncated = stat.size < this.offset
    const reset = replaced || truncated
    if (reset) {
      this.offset = 0
      this.remainder = ''
    }
    this.inode = stat.ino

    if (stat.size === this.offset) {
      return { lines: [], reset }
    }

    const length = stat.size - this.offset
    const descriptor = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      fs.readSync(descriptor, buffer, 0, length, this.offset)
      this.offset = stat.size
      const text = this.remainder + buffer.toString('utf8')
      const parts = text.split(/\r?\n/)
      this.remainder = parts.pop() ?? ''
      return {
        lines: parts.filter(Boolean),
        reset,
      }
    }
    finally {
      fs.closeSync(descriptor)
    }
  }
}
