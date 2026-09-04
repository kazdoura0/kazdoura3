// Fake ESC/POS network printer: accepts TCP connections on a port, logs bytes received
import net from 'net'
import fs from 'fs'
const port = Number(process.argv[2] || 9100)
let n = 0
net.createServer((s) => {
  const chunks = []
  s.on('data', (d) => chunks.push(d))
  s.on('end', () => { const b = Buffer.concat(chunks); n++; fs.writeFileSync(`/tmp/fakeprinter-${port}-${n}.bin`, b); console.log(`[${port}] received job #${n}: ${b.length} bytes, GSv0=${b.includes(Buffer.from([0x1d,0x76,0x30]))}, cut=${b.includes(Buffer.from([0x1d,0x56]))}`) })
  s.on('error', () => {})
}).listen(port, '0.0.0.0', () => console.log('fake printer on', port))
