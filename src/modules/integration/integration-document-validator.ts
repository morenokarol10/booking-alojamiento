export function isValidGuestDocument(
  type: 'CEDULA' | 'PASAPORTE' | 'RUC',
  value: string,
): boolean {
  if (type === 'PASAPORTE') return /^[A-Z0-9]{6,12}$/.test(value);
  if (type === 'RUC') return isValidEcuadorianRuc(value);
  return isValidEcuadorianId(value);
}

function isValidEcuadorianRuc(value: string): boolean {
  if (!/^[0-9]{13}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  const thirdDigit = Number(value[2]);
  if (province < 1 || province > 24) return false;
  if (thirdDigit <= 5) {
    return value.endsWith('001') && isValidEcuadorianId(value.slice(0, 10));
  }
  if (thirdDigit === 9) {
    return (
      value.endsWith('001') &&
      isValidMod11(value, 9, [4, 3, 2, 7, 6, 5, 4, 3, 2])
    );
  }
  if (thirdDigit === 6) {
    return (
      value.endsWith('0001') &&
      isValidMod11(value, 8, [3, 2, 7, 6, 5, 4, 3, 2])
    );
  }
  return false;
}

function isValidMod11(
  value: string,
  digits: number,
  weights: number[],
): boolean {
  const sum = value
    .slice(0, digits)
    .split('')
    .reduce(
      (total, digit, index) => total + Number(digit) * weights[index],
      0,
    );
  const check = 11 - (sum % 11);
  return (
    (check === 11 ? 0 : check === 10 ? -1 : check) === Number(value[digits])
  );
}

function isValidEcuadorianId(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (province < 1 || province > 24 || Number(value[2]) > 5) return false;
  const sum = value
    .slice(0, 9)
    .split('')
    .reduce((total, digit, index) => {
      const number = Number(digit);
      const weighted = index % 2 === 0 ? number * 2 : number;
      return total + (weighted > 9 ? weighted - 9 : weighted);
    }, 0);
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}
