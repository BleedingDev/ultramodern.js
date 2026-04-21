const garfish = {
  options: {},
  running: false,
  setOptions(options: Record<string, unknown>) {
    this.options = options;
  },
  registerApp(_apps: unknown) {},
  async loadApp() {
    return null;
  },
};

export default garfish;
