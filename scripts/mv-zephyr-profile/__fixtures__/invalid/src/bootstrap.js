window.__remotes__ = {
  catalog: 'https://cdn.example.com/catalog/remoteEntry.js',
};

document.write(
  '<script src="https://cdn.example.com/catalog/remoteEntry.js"></script>',
);

__webpack_public_path__ = window.assetBase;
