"""brotli de mentira para o fontTools: usa o zlib do Node, que já tem brotli."""
import subprocess
_JS = {
 'd': "const z=require('zlib');const c=[];process.stdin.on('data',d=>c.push(d)).on('end',()=>process.stdout.write(z.brotliDecompressSync(Buffer.concat(c))))",
 'c': "const z=require('zlib');const c=[];process.stdin.on('data',d=>c.push(d)).on('end',()=>process.stdout.write(z.brotliCompressSync(Buffer.concat(c),{params:{[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_MODE]:z.constants.BROTLI_MODE_FONT}})))",
}
def decompress(b): return subprocess.run(['node', '-e', _JS['d']], input=b, capture_output=True, check=True).stdout
def compress(b, mode=0, quality=11, lgwin=22, lgblock=0): return subprocess.run(['node', '-e', _JS['c']], input=b, capture_output=True, check=True).stdout
MODE_GENERIC, MODE_TEXT, MODE_FONT = 0, 1, 2
