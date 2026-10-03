'use server';

import 'server-only';

export async function incrementByForm(previous: number, formData: FormData) {
  return previous + Number(formData.get('count'));
}
