const fs = require('fs')
const path = require('path')

function copyFirst(candidates, dest) {
  const from = candidates.find((p) => fs.existsSync(p))
  if (!from) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(from, dest)
  console.log(`Copied ${path.basename(dest)}`)
  return true
}

copyFirst(
  [
    path.join('node_modules', 'lightningcss-win32-x64-msvc', 'lightningcss.win32-x64-msvc.node'),
    path.join(
      'node_modules',
      'lightningcss',
      'node_modules',
      'lightningcss-win32-x64-msvc',
      'lightningcss.win32-x64-msvc.node'
    ),
  ],
  path.join('node_modules', 'lightningcss', 'lightningcss.win32-x64-msvc.node')
)

copyFirst(
  [
    path.join(
      'node_modules',
      '@tailwindcss',
      'oxide-win32-x64-msvc',
      'tailwindcss-oxide.win32-x64-msvc.node'
    ),
    path.join(
      'node_modules',
      '@tailwindcss',
      'oxide',
      'node_modules',
      '@tailwindcss',
      'oxide-win32-x64-msvc',
      'tailwindcss-oxide.win32-x64-msvc.node'
    ),
  ],
  path.join('node_modules', '@tailwindcss', 'oxide', 'tailwindcss-oxide.win32-x64-msvc.node')
)
