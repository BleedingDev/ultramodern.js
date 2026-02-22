import { upload } from '@api/lambda/upload';
import React, { useEffect } from 'react';

const getMockImage = () => {
  const imageData =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
  const blob = new Blob(
    [Uint8Array.from(atob(imageData.split(',')[1]), c => c.charCodeAt(0))],
    { type: 'image/png' },
  );

  return new File([blob], 'mock_image.png', { type: 'image/png' });
};

const Page = () => {
  const [file, setFile] = React.useState<FileList | null>();
  const [fileName, setFileName] = React.useState<string>('');
  const setFileNameFromUploadResponse = (result: unknown) => {
    if (typeof result !== 'object' || result === null) {
      return;
    }
    const response = result as Record<string, unknown>;
    const directData =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : undefined;
    const nestedData =
      directData &&
      typeof directData.data === 'object' &&
      directData.data !== null
        ? (directData.data as Record<string, unknown>)
        : undefined;
    const fileNameValue =
      typeof directData?.file_name === 'string'
        ? directData.file_name
        : typeof nestedData?.file_name === 'string'
          ? nestedData.file_name
          : '';
    setFileName(fileNameValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData();
    if (file) {
      for (let i = 0; i < file.length; i++) {
        formData.append('images', file[i]);
      }
      await fetch('/bff-api/upload', {
        method: 'POST',
        body: formData,
      });
    }
  };
  const uploadMockImageViaFetch = async (mockImage: File) => {
    const formData = new FormData();
    formData.append('images', mockImage);
    const response = await fetch('/bff-api/upload', {
      method: 'POST',
      body: formData,
    });
    const body = await response.json();
    setFileNameFromUploadResponse(body);
  };

  const click = () => {
    if (!file) {
      return;
    }
    upload({
      files: {
        images: file,
      },
    }).catch(() => undefined);
  };

  useEffect(() => {
    const mockImage = getMockImage();
    upload({
      files: {
        images: mockImage,
      },
    })
      .then(setFileNameFromUploadResponse)
      .catch(() => uploadMockImageViaFetch(mockImage));
  }, []);

  return (
    <>
      <h1>File Upload</h1>
      <p className="mock_file">{fileName}</p>
      <form onSubmit={handleSubmit}>
        <input multiple type="file" onChange={handleChange} />
        <button type="submit">基于 fetch upload</button>
      </form>
      <div>
        <input multiple type="file" onChange={handleChange} />
        <button onClick={click}>一体化调用 upload</button>
      </div>
    </>
  );
};

export default Page;
