// Reuse only the two general clinic-review titles. Specialist reviews and serial
// follow-ups remain distinct. No overdue or later booking satisfies an earlier request.
export function existingClinicReview(
  plan: {
    id: string;
    title: string;
    status: string;
    category: string;
    dueDate: string | null;
    completesOn: any;
  }[],
  title: string,
  dueDate: string | null,
  today: string,
) {
  const general = (s: string) => /^(HF )?clinic review$/i.test(s);
  if (!general(title) || !dueDate) return undefined;
  return plan
    .filter(
      (p) =>
        p.status === "planned" &&
        p.category === "follow_up" &&
        p.completesOn?.type === "visit" &&
        general(p.title) &&
        p.dueDate &&
        p.dueDate >= today &&
        p.dueDate <= dueDate,
    )
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
}
