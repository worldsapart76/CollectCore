import { Link } from "react-router-dom";

export default function HomeTile({ title, to }) {
  return (
    <Link to={to} className="home-tile">
      <div className="home-tile-title">{title}</div>
    </Link>
  );
}
