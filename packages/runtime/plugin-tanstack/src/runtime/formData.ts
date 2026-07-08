// @effect-diagnostics asyncFunction:off extendsNativeError:off strictBooleanExpressions:off
import type React from 'react';

export type SubmitTarget =
  | HTMLFormElement
  | FormData
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>;
export type SubmitterElement = HTMLButtonElement | HTMLInputElement;

export type SubmitOptions = {
  action?: string;
  method?: string;
  encType?: string;
};

export function formDataToUrlSearchParams(formData: FormData) {
  const searchParams = new URLSearchParams();
  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      searchParams.append(key, value);
    }
  });
  return searchParams;
}

export function formDataToTextPlain(formData: FormData) {
  return Array.from(formData.entries())
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');
}

export function toFormData(target: SubmitTarget): FormData {
  if (target instanceof HTMLFormElement) {
    return new FormData(target);
  }

  if (target instanceof FormData) {
    return target;
  }

  if (target instanceof URLSearchParams) {
    const formData = new FormData();
    target.forEach((value, key) => {
      formData.append(key, value);
    });
    return formData;
  }

  const formData = new FormData();
  Object.entries(target).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null) {
      return;
    }
    formData.append(key, String(value));
  });
  return formData;
}

export function getSubmitter(event: React.FormEvent<HTMLFormElement>) {
  const nativeEvent = event.nativeEvent as SubmitEvent | undefined;
  const submitter = nativeEvent?.submitter;
  if (
    submitter instanceof HTMLButtonElement ||
    submitter instanceof HTMLInputElement
  ) {
    return submitter;
  }
  return null;
}

function appendSubmitterValue(
  formData: FormData,
  form: HTMLFormElement,
  submitter: SubmitterElement,
) {
  if (submitter.form !== form || submitter.disabled) {
    return;
  }

  if (submitter instanceof HTMLInputElement && submitter.type === 'image') {
    const namePrefix = submitter.name ? `${submitter.name}.` : '';
    formData.append(`${namePrefix}x`, '0');
    formData.append(`${namePrefix}y`, '0');
    return;
  }

  if (
    !submitter.name ||
    submitter.type === 'button' ||
    submitter.type === 'reset'
  ) {
    return;
  }

  formData.append(submitter.name, submitter.value);
}

export function createFormDataFromSubmit({
  form,
  submitter,
}: {
  form: HTMLFormElement;
  submitter: SubmitterElement | null;
}) {
  if (submitter) {
    try {
      return new FormData(form, submitter);
    } catch {}
  }
  const formData = new FormData(form);
  if (submitter) {
    appendSubmitterValue(formData, form, submitter);
  }
  return formData;
}

export function resolveSubmitOptionsFromForm({
  form,
  submitter,
  action,
  method,
  encType,
}: {
  form: HTMLFormElement;
  submitter: SubmitterElement | null;
  action?: string;
  method?: string;
  encType?: string;
}): Required<SubmitOptions> {
  const resolvedAction =
    submitter?.getAttribute('formaction') ||
    action ||
    form.getAttribute('action') ||
    '.';
  const resolvedMethod = (
    submitter?.getAttribute('formmethod') ||
    method ||
    form.getAttribute('method') ||
    'get'
  ).toLowerCase();
  const resolvedEncType =
    submitter?.getAttribute('formenctype') ||
    encType ||
    form.getAttribute('enctype') ||
    'application/x-www-form-urlencoded';

  return {
    action: resolvedAction,
    method: resolvedMethod,
    encType: resolvedEncType,
  };
}
