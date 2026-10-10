export const MEDICAL_KINDS = ['checkup', 'visit', 'vision'];
export const VISION_GROUPS = [
  [['leftUnaided', '左眼裸眼视力'], ['rightUnaided', '右眼裸眼视力'],
    ['leftCorrected', '左眼矫正视力'], ['rightCorrected', '右眼矫正视力']],
  [['leftSphere', '左眼球镜（D）'], ['rightSphere', '右眼球镜（D）'],
    ['leftCylinder', '左眼柱镜（D）'], ['rightCylinder', '右眼柱镜（D）'],
    ['leftAxis', '左眼轴位（°）'], ['rightAxis', '右眼轴位（°）']],
];
export const VISION_FIELDS = [...VISION_GROUPS.flat(), ['pupillaryDistance', '瞳距（mm）']];
