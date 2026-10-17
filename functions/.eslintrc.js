module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    "ecmaVersion": 2018,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    // El código existente tiene estilos mezclados. Mantener las reglas de
    // errores reales y desactivar aquí solo las reglas de formato/documentación
    // que producirían cientos de cambios mecánicos en toda la base.
    "valid-jsdoc": "off",
    "require-jsdoc": "off",
    "max-len": "off",
    "comma-dangle": "off",
    "object-curly-spacing": "off",
    "quote-props": "off",
    "indent": "off",
    "no-multi-spaces": "off",
    "operator-linebreak": "off",
    "brace-style": "off",
    "block-spacing": "off",
    "one-var": "off",
    "space-before-function-paren": "off",
    "linebreak-style": "off",
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
