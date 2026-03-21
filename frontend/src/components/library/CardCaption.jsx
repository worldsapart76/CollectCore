import { buildCardCaption } from "../../utils/captionUtils";

export default function CardCaption({ card }) {
  return <div className="card-caption">{buildCardCaption(card)}</div>;
}