import { Router, type IRouter } from "express";
import healthRouter from "./health";
import travelRouter from "./travel";

const router: IRouter = Router();

router.use(healthRouter);
router.use(travelRouter);

export default router;
