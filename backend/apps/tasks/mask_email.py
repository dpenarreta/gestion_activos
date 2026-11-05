"""Correo enmascarado para listados de personas (portado de Nexo,
`apps.core.mask_email`): conserva el primer carácter de la parte local y de la
etiqueta del dominio, enmascara el resto (hasta 5 asteriscos) y deja intacto
el resto del dominio. Lo usa la lista de Equipo."""


def mask_email(email: str) -> str:
    at = email.find("@")
    if at == -1:
        return email

    local = email[:at]
    domain = email[at + 1 :]
    dot = domain.find(".")
    label = domain if dot == -1 else domain[:dot]
    rest = "" if dot == -1 else domain[dot:]

    def _mask(part: str) -> str:
        if len(part) <= 1:
            return part
        return part[0] + "*" * min(len(part) - 1, 5)

    return f"{_mask(local)}@{_mask(label)}{rest}"
