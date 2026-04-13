import { Link } from "react-router-dom";

export default function HomeTile({ title, description, to }) {
  return (
    <Link to={to} className="home-tile">
      <div className="home-tile-title">{title}</div>
      <div className="home-tile-description">{description}</div>
    </Link>
  );
}