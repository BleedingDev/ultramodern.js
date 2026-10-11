export default function PlainApp() {
  return (
    <main id="plain-native-component">
      <h1>Plain native component</h1>
      <button onClick={() => console.info('plain-native-click')}>
        Native click
      </button>
    </main>
  );
}
