// Fixture: beta consumes alpha's Widget surface — closes the alpha<->beta cycle.
import AlphaWidget from '@fx/alpha/Widget'; // G1 -> beta->alpha#Widget
export default function BetaPage() {
  return AlphaWidget;
}
