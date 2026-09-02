'use strict';

const validatorAwareHandlerFactories = new WeakSet();

module.exports = {
  register(factory) {
    validatorAwareHandlerFactories.add(factory);
    return factory;
  },
  is(factory) {
    return (
      typeof factory === 'function' &&
      validatorAwareHandlerFactories.has(factory)
    );
  },
};
