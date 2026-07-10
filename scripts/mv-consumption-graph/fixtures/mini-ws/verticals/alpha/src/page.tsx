// Fixture: alpha consumes beta's Widget surface (legit published subpath), which
// together with beta->alpha forms a synthetic cross-unit cycle.
import BetaWidget from '@fx/beta/Widget'; // G1 -> alpha->beta#Widget
export default function AlphaPage() {
  return BetaWidget;
}
