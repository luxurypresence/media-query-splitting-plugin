const config = {
  presets: [
    [
      '@babel/preset-env', {
        targets: {
          browsers: [
            'last 2 versions',
          ],
          node: 'current',
        },
        useBuiltIns: 'entry',
        corejs: 2,
      },
    ],
  ],
}


module.exports = config
