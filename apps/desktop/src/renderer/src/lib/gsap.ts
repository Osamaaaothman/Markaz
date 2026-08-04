import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { SplitText } from "gsap/SplitText";

// Registered once at module load (imported before any component uses GSAP),
// per the gsap-react/gsap-plugins skill guidance.
gsap.registerPlugin(useGSAP, DrawSVGPlugin, SplitText);

export { gsap, useGSAP, SplitText };
