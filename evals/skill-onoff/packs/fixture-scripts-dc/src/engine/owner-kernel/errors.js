'use strict';

class OwnerKernelError extends Error {
  constructor(message, code = 'OWNER_KERNEL_ERROR') {
    super(message);
    this.name = 'OwnerKernelError';
    this.code = code;
  }
}

class OwnerKernelBlockedError extends OwnerKernelError {
  constructor(message, code = 'OWNER_KERNEL_BLOCKED') {
    super(message, code);
    this.name = 'OwnerKernelBlockedError';
  }
}

module.exports = {
  OwnerKernelBlockedError,
  OwnerKernelError,
};
